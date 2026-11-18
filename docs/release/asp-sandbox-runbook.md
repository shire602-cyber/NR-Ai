# ASP sandbox readiness: A-Cube and Complyance

Owner-run. Both accredited ASPs are built from their published documentation and pass the
doc-derived contract fixtures. Neither has been exercised against its real sandbox yet. This runbook
lists what each needs, how to run the sandbox dry run, and what to ask each ASP for.

**Ground rules**

- **One ASP at a time.** Choose it with `EINVOICE_PROVIDER` (`acube` or `complyance`). There is
  **no default**: unset means e-invoicing is off and hidden. A selected provider without its
  credentials stays "Not connected" (`tests/unit/einvoice-provider-registry.test.ts`).
- **ZATCA stays hidden.** It is listed only for a Saudi company
  (`tests/unit/sidebar-nav-behaviour.test.ts`). Leave `ZATCA_ENV` unset in the UAE deployment.
- **Secrets live in the secret store only**, never in git, chat, tickets or logs. This document
  names the variables; it never holds a value.
- **Sandbox only** until the checklist below is complete and the owner signs off. Production
  switches are `ACUBE_ENV=production` / `COMPLYANCE_ENV=production`.

## Environment variables (names only)

### A-Cube (`EINVOICE_PROVIDER=acube`, MoF register no. 188961)

| Variable                                                      | Secret | Required               | Purpose                                                                         |
| ------------------------------------------------------------- | ------ | ---------------------- | ------------------------------------------------------------------------------- |
| `ACUBE_EMAIL`                                                 | yes    | yes                    | Sandbox account login                                                           |
| `ACUBE_PASSWORD`                                              | yes    | yes                    | Sandbox account password                                                        |
| `ACUBE_ENV`                                                   | no     | no (default `sandbox`) | `sandbox` (`ae-sandbox.api.acubeapi.com`) or `production`                       |
| `ACUBE_WEBHOOK_BASE_URL`                                      | no     | for webhooks           | Public https base A-Cube calls back                                             |
| `ACUBE_WEBHOOK_TOKEN`                                         | yes    | optional               | Shared token header (authType=header)                                           |
| `ACUBE_WEBHOOK_TOKEN_HEADER`                                  | no     | optional               | Header name for the token (default `X-Acube-Token`)                             |
| `ACUBE_SIGNATURE_PUBLIC_KEY`                                  | no     | optional               | Pin A-Cube's Ed25519 key (PEM); default fetched and cached                      |
| `ACUBE_WEBHOOK_MAX_AGE_SECONDS`                               | no     | optional               | Signature age window (default 43200)                                            |
| `ACUBE_INVOICE_SUBMIT_PATH` / `ACUBE_CREDIT_NOTE_SUBMIT_PATH` | no     | optional               | Override submit paths (defaults `/invoices/outgoing`, `/credit-notes/outgoing`) |
| `ACUBE_TIMEOUT_MS`                                            | no     | optional               | HTTP timeout                                                                    |
| `ACUBE_BASE_URL` / `ACUBE_LOGIN_URL`                          | no     | optional               | Host overrides (normally unset)                                                 |

### Complyance (`EINVOICE_PROVIDER=complyance`, MoF register no. 112219)

| Variable                                                 | Secret | Required               | Purpose                                                                                    |
| -------------------------------------------------------- | ------ | ---------------------- | ------------------------------------------------------------------------------------------ |
| `COMPLYANCE_API_KEY`                                     | yes    | yes                    | Sandbox ("mock") key; a production key with write access later                             |
| `COMPLYANCE_ENV`                                         | no     | no (default `sandbox`) | `sandbox` or `production`                                                                  |
| `COMPLYANCE_WEBHOOK_SECRET`                              | yes    | for webhooks           | HMAC signing secret shown once at webhook creation (unset: webhook answers 503, poll only) |
| `COMPLYANCE_WEBHOOK_BASE_URL`                            | no     | for webhooks           | Public https base                                                                          |
| `COMPLYANCE_WEBHOOK_ALGORITHM`                           | no     | optional               | `sha256` or `sha512`, as chosen at creation                                                |
| `COMPLYANCE_WEBHOOK_MAX_AGE_SECONDS`                     | no     | optional               | Signature age window                                                                       |
| `COMPLYANCE_BASE_URL`                                    | no     | optional               | Default `https://prod.gets.complyance.io` (same host for both environments)                |
| `COMPLYANCE_SUBMIT_FORMAT`                               | no     | optional               | `gets` (default GETS mapping) or `xml` (Unify XML envelope)                                |
| `COMPLYANCE_SOURCE_PREFIX` / `COMPLYANCE_SOURCE_VERSION` | no     | optional               | Per-company invoice source `<prefix>-<companyId>:<version>`                                |
| `COMPLYANCE_USER_AGENT`                                  | no     | optional               | Required by Complyance's WAF (a default is sent)                                           |
| `COMPLYANCE_TIMEOUT_MS` / `COMPLYANCE_POLL_DAYS`         | no     | optional               | HTTP timeout; purchase poll window                                                         |

### Dry run inputs (not secrets)

| Variable                   | Purpose                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASP_DRYRUN_SELLER_TRN`    | TRN of the legal entity linked in the sandbox. The seller EndpointID is `0235:<first 10 digits>`. A-Cube only routes a document whose supplier endpoint is the linked TIN. |
| `ASP_DRYRUN_BUYER_TRN`     | Buyer TRN for the sample (defaults to the fixture buyer)                                                                                                                   |
| `COMPLYANCE_DRYRUN_SOURCE` | Name of the invoice source created in the Complyance sandbox (default `<prefix>-dryrun`)                                                                                   |

## Dry run

[`scripts/ops/asp-sandbox-dryrun.ts`](../../scripts/ops/asp-sandbox-dryrun.ts) builds one sample
PINT AE tax invoice (380, standard-rated, AED). It uses the same generator and data checks as
production, with seller and buyer EndpointIDs on scheme 0235. It validates the invoice locally
against the UBL 2.1 XSD, the PINT AE 2026.5 schematron and the rule list. Then it submits it to the
**sandbox** of each ASP whose credentials are in the environment.

```bash
npx tsx scripts/ops/asp-sandbox-dryrun.ts --validate-only
```

```bash
npx tsx scripts/ops/asp-sandbox-dryrun.ts --provider acube --status
```

```bash
npx tsx scripts/ops/asp-sandbox-dryrun.ts --provider complyance --status
```

| Situation                                                    | Result                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No credentials for a provider                                | `SKIP <ASP>: not configured (missing ...)`. Exit 0 if nothing ran. Nothing is prompted for.                                                                                          |
| `ACUBE_ENV` / `COMPLYANCE_ENV` set to anything but `sandbox` | `REFUSED`, exit 2. The script never talks to production.                                                                                                                             |
| Sample fails local validation                                | Findings printed, exit 1, nothing sent                                                                                                                                               |
| Submitted                                                    | One JSON line per ASP: `status`, `delivery`, `reporting`, `providerMessageId`, `providerStatus`, `errorCode`, `reasons`. `--status` polls once. Exit 1 if an ASP rejected or failed. |

The script needs no database and prints no secret. Each run uses a fresh invoice number
(`DRYRUN-<timestamp>`) and UUID, so a re-run is not refused as a duplicate.

Record each sandbox run (date, ASP, `providerMessageId`, outcome, reasons) in this file's log section
before switching any environment to production.

## What we need from each ASP (checklist)

### A-Cube

- [ ] Sandbox account (email and password) issued to the owner; stored in the secret store as
      `ACUBE_EMAIL` and `ACUBE_PASSWORD`.
- [ ] Sandbox legal entity for our test TRN, onboarded with "Simulate onboarding". Record its TIN
      for `ASP_DRYRUN_SELLER_TRN`.
- [ ] Confirmation of the supplier EndpointID A-Cube routes on: we send `0235` + 10-digit TIN,
      as its Quick Start does (`tests/unit/einvoice-acube-endpoint-scheme.test.ts`).
- [ ] Submit path: `/invoices/outgoing` or `/invoices`. Also whether a re-post with the same UUID is
      refused.
- [ ] Real 422 validation body and status vocabulary. Then re-record
      `tests/fixtures/pint-ae/asp/acube/*.json`.
- [ ] TDD (Tax Data Document) semantics and the MLS rejection flow, which maps to `report_failed`.
- [ ] Webhooks: delivered event names, delivery-error payload, retry re-signing, Ed25519 public key
      format. Their callback must reach `ACUBE_WEBHOOK_BASE_URL` through our proxy.
- [ ] Legal-entity status casing (`RESERVED` / `Active`) and reservation expiry.
- [ ] Buyer without a TRN (foreign or unregistered): which endpoint scheme and ID A-Cube expects.
      We refuse such a document with `EINVOICE_BUYER_ENDPOINT_MISSING` until one is recorded.
- [ ] Production credentials and the EmaraTax step where the taxpayer selects
      "PLATFORM ACUBE TECHNOLOGIES L.L.C".

### Complyance

- [ ] Sandbox ("mock") API key issued to the owner; stored as `COMPLYANCE_API_KEY`.
- [ ] Sandbox onboarding with a real authorised TIN (their sandbox requires one). Record it for
      `ASP_DRYRUN_SELLER_TRN`.
- [ ] An invoice source created in the sandbox for the dry run (`COMPLYANCE_DRYRUN_SOURCE`), and
      confirmation of the per-company source naming `<prefix>-<companyId>:<version>`.
- [ ] Our GETS payload passes `purpose: "validate"` for every fixture type: exemption reason codes,
      item type, emirate codes, trade-licence authority names, `grossPrice` / `baseQuantity`. Also
      whether `parties.*.peppolId` plus `peppol_*_peppolIdScheme = 0235` is the routing they expect.
- [ ] If `COMPLYANCE_SUBMIT_FORMAT=xml` is preferred: the XML mapping built in their Integration
      engine from our sample.
- [ ] Real 422 bodies (GETS-HEAD-010), 401/403 bodies, `final_invalid` `errors[].source` values. Then
      re-record `tests/fixtures/pint-ae/asp/complyance/*.json`.
- [ ] Webhook signing secret (`COMPLYANCE_WEBHOOK_SECRET`) and algorithm. Also the payloads of
      `invoice.passed` / `invoice.failed` and onboarding events.
- [ ] Purchase GET `data.xml` encoding and `attribution.companyId` on purchase webhooks.
- [ ] Buyer without a TRN: expected peppolId scheme and value (see A-Cube item above).
- [ ] UAE per-document credit cost and Unify rate limits; production key with write access.

## Sandbox run log

| Date | ASP | Seller TIN | providerMessageId | Outcome | Notes |
| ---- | --- | ---------- | ----------------- | ------- | ----- |
|      |     |            |                   |         |       |
