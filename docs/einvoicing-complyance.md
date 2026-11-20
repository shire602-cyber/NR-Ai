# UAE e-invoicing through Complyance (E2)

Complyance (Complyance Electronics L.L.C) is on the Ministry of Finance register of accredited
e-invoicing service providers, accreditation no. **112219**
([register](https://mof.gov.ae/en/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/),
row 15 of 88, "Last updated on 16/11/2026", read 2026-11-17). It is the second provider Muhasib is
built against (see [einvoicing-providers.md](einvoicing-providers.md)); A-Cube is the first
([einvoicing-acube.md](einvoicing-acube.md)). API facts were read from docs.complyance.io on
2026-11-17. **No live Complyance call has been made yet**: everything below was built against
doc-derived fixtures and must be confirmed in the Complyance sandbox (last section).

## Configuration

`EINVOICE_PROVIDER=complyance` with `COMPLYANCE_API_KEY` (secret store only; a sandbox "mock" key or
a production key with write access) and `COMPLYANCE_ENV` (`sandbox` default, `production`). The
webhook needs `COMPLYANCE_WEBHOOK_SECRET` (the signing secret shown once when the webhook is created)
and, for the URL shown in settings, `COMPLYANCE_WEBHOOK_BASE_URL`. Optional: `COMPLYANCE_BASE_URL`,
`COMPLYANCE_SUBMIT_FORMAT` (`gets` default | `xml`), `COMPLYANCE_SOURCE_PREFIX` (`muhasib`),
`COMPLYANCE_SOURCE_VERSION` (`v1`), `COMPLYANCE_USER_AGENT` (required by Complyance's WAF; a default is
sent), `COMPLYANCE_TIMEOUT_MS`, `COMPLYANCE_POLL_DAYS` (3), `COMPLYANCE_WEBHOOK_ALGORITHM` (`sha256` |
`sha512`), `COMPLYANCE_WEBHOOK_MAX_AGE_SECONDS` (3600). All are listed in `.env.example`. Without them
every transmission call answers 503 `EINVOICE_PROVIDER_NOT_CONFIGURED` and settings show the neutral
"Not connected" card.

## Adapter (`server/services/einvoice/providers/complyance.ts`)

| Need       | Implementation                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth       | static key: `Authorization: Bearer` on `/api/v3/unify` and `/api/v3/documents*`, `X-API-Key` on `/v3/connect/*`; one host for both environments, the body's `environment` must match the key; the key is never logged         |
| Submit     | `POST /api/v3/unify` with `new-api: true`, `{country: AE, environment, purpose: invoicing, source: "<name>:<version>", documentType, payload}`; payload is GETS derived from our validated PINT AE UBL (`complyance-gets.ts`) |
| XML option | `COMPLYANCE_SUBMIT_FORMAT=xml`: our UBL inside a `<UnifyRequest>` envelope, for a workspace that built an XML mapping in Complyance's Integration engine                                                                      |
| Errors     | 422 `errors[]` → rejection reasons (field = `getsPath`, rule = `code`); GETS-HEAD-010 → `COMPLYANCE_DUPLICATE_NUMBER`; 400/404/409/412/413/415 → rejected with code; 401/403/429/5xx/transport → retryable                    |
| Status     | `GET /api/v3/documents/{id}?type=sales`; `state` mapped onto both tracks (below); unknown → `delivery_failed`, never success                                                                                                  |
| Inbound    | `GET /api/v3/documents?type=purchases&companyId=…&from=…` (cursor), then `GET /api/v3/documents/{id}?type=purchases` → `data.xml` → `processInboundEInvoice` → draft bill (`origin = einvoice`)                               |
| Onboarding | `POST /v3/connect/companies` (create), `GET /v3/connect/companies` (find / re-read)                                                                                                                                           |
| Cancel     | none: `capabilities.cancel = false`; a sent invoice is corrected with a credit note                                                                                                                                           |

### Why GETS, not PINT AE XML

Complyance's Unify API takes the invoice in GETS (its own JSON, "a superset of UBL 2.1") and produces
the PINT AE e-invoice itself; XML only goes through a mapping built in its portal. We keep one source of
truth: the PINT AE UBL we generate and validate (XSD + schematron + rule list). `ublToGets` reads that
document and writes the same facts at the documented GETS paths (`/countries/ae/fields/`), including
the transaction-type flags (`ProfileExecutionID`) as document modifiers (`export`, `free_trade_zone`, …),
reverse charge, credit-note reason and preceding invoice, foreign currency (tax currency, rate, AED tax
total) and code-list values (payment means `CREDIT_TRANSFER`, credit-note reasons
`CONSIDERATION_ALTERED`, reverse-charge goods `CRUDE_OR_REFINED_OIL`). Exemption reason codes our
generator writes (`VATEX-AE-*`) have no GETS value and are sent as text only: confirm in sandbox.

## Two tracks

| Complyance `state`                  | Delivery        | FTA reporting | Code                       |
| ----------------------------------- | --------------- | ------------- | -------------------------- |
| submitted                           | queued          | pending       |                            |
| processing                          | sending         | pending       |                            |
| delivery_success                    | delivered       | pending       |                            |
| delivery_failed (not terminal)      | sending         | pending       | (Complyance keeps trying)  |
| delivery_failed (terminal)          | delivery_failed | pending       | COMPLYANCE_DELIVERY_FAILED |
| final_valid                         | delivered       | reported      |                            |
| final_invalid, `source: government` | delivered       | report_failed | EINVOICE_REPORT_FAILED     |
| final_invalid, otherwise            | rejected        | pending       | COMPLYANCE_FINAL_INVALID   |
| rejected (Needs Correction)         | rejected        | pending       | COMPLYANCE_VALIDATION      |

`final_valid` means both the buyer's ASP and the FTA accepted the document (`ftaApprovedStatus:
APPROVED`). The F16 mandate gate still applies: before the company's go-live the reporting track reads
`not_required` whatever the provider says. After `final_invalid` or GETS-HEAD-010 the number cannot be
sent again (`NEW_DOCUMENT_REQUIRED_CODES`): resubmit answers 409 `EINVOICE_NEW_DOCUMENT_REQUIRED` and
the status panel says to issue a credit note and a new invoice.

## Onboarding and gating

Complyance has nothing to reserve. Flow (`providers/complyance-onboarding.ts`):

1. the user enters the administrator email the EmaraTax authorisation uses (settings card,
   `POST …/einvoicing/complyance/connect`); our row is `reserved`;
2. the company's administrator authorises Complyance as ASP in EmaraTax (UAE PASS) with that email;
3. we register the company: `POST /v3/connect/companies` {TIN, that email, branch, source
   `muhasib-<companyId>:v1`}. `ASP_LINKAGE_NOT_FOUND` keeps it `reserved` and the
   `einvoice.complyancePoll` job (every 10 minutes) or "Check status" retries; a timeout or
   `CONNECT_COMPANY_ALREADY_EXISTS` is recovered by listing, never by creating again;
4. registered but `readyForInvoicing: false` (Default GETS Mapping test cases not passed) → `pending`;
   ready → `active`; an inactive source → `inactive`.

Sending answers 409 `EINVOICE_LEGAL_ENTITY_NOT_ACTIVE` / `EINVOICE_LEGAL_ENTITY_DELINKED` exactly as for
A-Cube, and 422 `EINVOICE_SUPPLIER_ENDPOINT_MISMATCH` when our supplier endpoint is not `0235:<TIN>`
(Complyance would answer AE-PEPPOL-008). The source name/version, branch and mapping readiness live in
`einvoice_legal_entities.provider_details` (migration 0117).

## Webhooks, polling and idempotency

`POST /api/webhooks/einvoice/complyance/:environment` (raw body, CSRF-exempt): the
`X-Webhook-Signature` HMAC (lowercase hex, sha256 or sha512) of the raw body with
`COMPLYANCE_WEBHOOK_SECRET` is checked in constant time; an unset secret answers 503 (never accept
unsigned events), a bad signature 401. The timestamp header is not signed, so replay protection is the
inbox's unique event key; `X-Webhook-Timestamp` older than the window is still refused as a cheap filter.
Events are normalised (`complyance-events.ts`) into the shared durable inbox
(`einvoice_provider_events`, job `einvoice.providerEvents`): purchases → `document.received` keyed
`doc:<id>:received` (the same key as the poll), `invoice.passed`/`failed` → re-read the status,
`company.*`/`peppol.id.*` → re-read the company. Answers are 200 fast; 5xx for "not configured" so
Complyance retries (it treats 4xx as permanent).

No Complyance webhook reports a document's final outcome, so `einvoice.complyancePoll` refreshes every
in-flight document (and lists purchases for the last `COMPLYANCE_POLL_DAYS` days per active company).

Complyance is idempotent by document number: a repeat after a lost response answers 422 GETS-HEAD-010
**without the document id**, and there is no sales listing. Muhasib therefore never posts twice (claim +
re-read as for A-Cube), records `COMPLYANCE_DUPLICATE_NUMBER`, does not retry it, and offers
`POST /api/companies/:companyId/einvoicing/complyance/link {invoiceId, documentId}`: a person finds the
id in the Complyance Invoice Portal, we check that document's number is this invoice's, then track it.

## To verify against the live Complyance sandbox

1. Our GETS payload for every fixture type passes `purpose: "validate"` (exemption reason codes, item
   type, emirate codes, trade-licence authority names, `grossPrice`/`baseQuantity`).
2. Real 422 bodies (GETS-HEAD-010 message), and whether 401/403 bodies match the docs.
3. `final_invalid` `errors[].source` values (our FTA vs buyer-ASP split) and whether `delivery_failed`
   ever becomes terminal for the UAE.
4. Purchase GET `data.xml` (plain or base64) and `attribution.companyId` on purchase webhooks.
5. Payloads of `invoice.passed` / `invoice.failed` and the onboarding events; the timestamp format.
6. Connect `search` semantics and `readyForInvoicing` right after onboarding in an ISV workspace; the
   exact EmaraTax wording of the provider (we show the register name "COMPLYANCE ELECTRONICS L.L.C").
7. UAE per-document credit cost, rate limits on Unify, and re-record
   `tests/fixtures/pint-ae/asp/complyance/*.json`.
