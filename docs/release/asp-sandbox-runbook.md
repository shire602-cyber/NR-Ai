# ASP sandbox readiness: A-Cube and Complyance

Owner-run. Both accredited ASPs are built from their published documentation and pass the
doc-derived contract fixtures. Neither has been exercised against its real sandbox yet. This runbook
lists what each needs, how to run the sandbox dry run, and what to ask each ASP for.

**A-Cube, short owner version:** [einvoicing-acube-sandbox-runbook.md](../einvoicing-acube-sandbox-runbook.md)
(`npm run test:acube-sandbox`).

**Ground rules**

- **One company and one ASP at a time.** Choose the ASP in the company’s e-invoicing settings
  and provision its encrypted runtime credential bundle. The standalone dry run selects an ASP
  with `--provider`. [Company e-invoicing configuration](../einvoicing-company-runtime.md)
- **ZATCA stays hidden.** It is off unless `ZATCA_ENABLED=true` (`server/services/zatca/flag.ts`):
  the endpoints answer 503, `/api/features` reports `zatca: false`, and a Saudi company is treated
  as UAE. Leave `ZATCA_ENABLED` unset.
- **Secrets live in the secret store only**, never in git, chat, tickets or logs. This document
  names the variables; it never holds a value.
- **Sandbox only** until the checklist below is complete and the owner signs off. Production
  switches are `ACUBE_ENV=production` / `COMPLYANCE_ENV=production`.

## Owner request sheet: first live sandbox submission (one page)

What the owner (Abdurahman) asks each ASP for, and where each answer goes. Values go into the secret
store or environment settings, never into chat, tickets or git. Once both columns are filled, run the
dry run (below) for that ASP.

| #   | Ask                                | A-Cube (MoF 188961)                                                                                                                                                                                                                                                                    | Complyance (MoF 112219)                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Sandbox account**                | A-Cube UAE sandbox account (login email and password) for `ae-sandbox.api.acubeapi.com`                                                                                                                                                                                                | A Complyance sandbox workspace with a sandbox ("mock") API key                                                                                                                                                                                                                               |
| 2   | **Credentials, as variable names** | `ACUBE_EMAIL`, `ACUBE_PASSWORD` (secrets); `ACUBE_ENV=sandbox`                                                                                                                                                                                                                         | `COMPLYANCE_API_KEY` (secret); `COMPLYANCE_ENV=sandbox`                                                                                                                                                                                                                                      |
| 3   | **Test seller (our side)**         | A sandbox legal entity onboarded with "Simulate onboarding" for one test TRN. A-Cube routes on the supplier EndpointID `0235:<first 10 digits of that TRN>`.                                                                                                                           | A sandbox company onboarded with a **real authorised TIN** (their sandbox requires one), plus an **invoice source** created for the dry run                                                                                                                                                  |
| 4   | **Values to record (not secrets)** | `ASP_DRYRUN_SELLER_TRN` = that legal entity's 15-digit TRN                                                                                                                                                                                                                             | `ASP_DRYRUN_SELLER_TRN` = that TIN's 15-digit TRN; `COMPLYANCE_DRYRUN_SOURCE` = the source name (optional `COMPLYANCE_SOURCE_VERSION`, default `v1`)                                                                                                                                         |
| 5   | **Test buyer and Peppol IDs**      | A test buyer participant they accept: a 15-digit test TRN for `ASP_DRYRUN_BUYER_TRN`, giving EndpointID `0235:<10-digit TIN>`. Ask which scheme and ID to use for a buyer **without** a TRN (foreign or B2C); we refuse those today with `EINVOICE_BUYER_ENDPOINT_MISSING`.            | The same: a test buyer TRN or Peppol ID they route in sandbox, and the expected `peppolId` / scheme for a buyer without a TRN                                                                                                                                                                |
| 6   | **Webhook configuration** | Set `ACUBE_WEBHOOK_BASE_URL` to the public HTTPS origin and copy the company callback URL from **Developer details**. Register it through the authenticated company setup API with a company-dedicated A-Cube account. If A-Cube uses a callback token, put it in the company bundle as `webhookToken`. | Poll for UAE outbound sales status. For supported callback event types, set `COMPLYANCE_WEBHOOK_BASE_URL` to the HTTPS origin, use the company callback URL from **Developer details**, and set the company bundle `webhookSecret` and matching `COMPLYANCE_WEBHOOK_ALGORITHM`. |
| 7   | **Network**                        | Our host must reach `ae-sandbox.api.acubeapi.com` and `common.api.acubeapi.com` (login). Their callbacks must reach our public host.                                                                                                                                                   | Our host must reach `prod.gets.complyance.io` (both environments). Their callbacks must reach our public host.                                                                                                                                                                               |
| 8   | **Confirm in writing**             | Submission on `/invoices` and `/credit-notes`, duplicate-UUID behaviour, the 422 body format                                                                                                                                                                                       | Whether GETS JSON (default) or Unify XML is preferred, the UAE credit cost per document, and rate limits                                                                                                                                                                                     |

The company UUID in each callback URL selects the app’s scoped credentials. A-Cube destinations
receive events at the credential-account level. Use the full provider URL from **Developer details**
and follow the company setup runbook. The standalone dry run can poll status with `--status`.
[Company credential and webhook setup](../einvoicing-company-runtime.md)

Activation order for the first submission, one ASP at a time:

1. Store the secrets from row 2.
2. Select the company and ASP in e-invoicing settings if testing callbacks through the application.
3. Set the row 4 values.
4. Run:
   ```bash
   npx tsx scripts/ops/asp-sandbox-dryrun.ts --provider <acube|complyance> --status
   ```
5. Log the result in "Sandbox run log" at the end of this file.

The detailed checklists further down repeat these items, plus the follow-up checks (fixture
re-recording, status vocabulary, TDD).

## Environment variables (names only)

### A-Cube (`EINVOICE_PROVIDER=acube`, MoF register no. 188961)

| Variable                                                      | Secret | Required               | Purpose                                                                         |
| ------------------------------------------------------------- | ------ | ---------------------- | ------------------------------------------------------------------------------- |
| `ACUBE_EMAIL`                                                 | yes    | yes                    | Sandbox account login                                                           |
| `ACUBE_PASSWORD`                                              | yes    | yes                    | Sandbox account password                                                        |
| `ACUBE_ENV`                                                   | no     | no (default `sandbox`) | `sandbox` (`ae-sandbox.api.acubeapi.com`) or `production`                       |
| `ACUBE_WEBHOOK_BASE_URL`                                      | no     | for webhooks           | Public https base A-Cube calls back                                             |
| `webhookToken`                                               | yes    | optional               | Shared token in the company’s encrypted A-Cube bundle                           |
| `ACUBE_WEBHOOK_TOKEN_HEADER`                                  | no     | optional               | Header name for the token (default `X-Acube-Token`)                             |
| `ACUBE_SIGNATURE_PUBLIC_KEY`                                  | no     | optional               | Pin A-Cube's Ed25519 key (PEM); default fetched and cached                      |
| `ACUBE_WEBHOOK_MAX_AGE_SECONDS`                               | no     | optional               | Signature age window (default 43200)                                            |
| `ACUBE_INVOICE_SUBMIT_PATH` / `ACUBE_CREDIT_NOTE_SUBMIT_PATH` | no     | optional               | Override submit paths (defaults `/invoices`, `/credit-notes`) |
| `ACUBE_TIMEOUT_MS`                                            | no     | optional               | HTTP timeout                                                                    |
| `ACUBE_BASE_URL` / `ACUBE_LOGIN_URL`                          | no     | optional               | Host overrides (normally unset)                                                 |

### Complyance (`EINVOICE_PROVIDER=complyance`, MoF register no. 112219)

| Variable                                                 | Secret | Required               | Purpose                                                                                    |
| -------------------------------------------------------- | ------ | ---------------------- | ------------------------------------------------------------------------------------------ |
| `COMPLYANCE_API_KEY`                                     | yes    | yes                    | Sandbox ("mock") key; a production key with write access later                             |
| `COMPLYANCE_ENV`                                         | no     | no (default `sandbox`) | `sandbox` or `production`                                                                  |
| `webhookSecret`                                        | yes    | for webhooks           | HMAC signing secret in the company’s encrypted Complyance bundle                           |
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
| No credentials for a provider                                | `SKIP <ASP>: not configured (missing ...)`. Exit 1 with `--status` if no provider could be checked. Exit 0 if nothing ran without `--status`. Nothing is prompted for. |
| `ACUBE_ENV` / `COMPLYANCE_ENV` set to anything but `sandbox` | `REFUSED`, exit 2. The script never talks to production.                                                                                                                             |
| Sample fails local validation                                | Findings printed, exit 1, nothing sent                                                                                                                                               |
| Submitted                                                    | The result includes `status`, `delivery`, `reporting`, `providerMessageId`, `providerStatus`, `errorCode`, and `reasons`. `--status` checks the returned document ID once. Exit 1 on rejection, failure, or an unverified status check. |

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
- [ ] Confirm submission on `/invoices` and `/credit-notes` and whether a re-post with the same
      UUID is refused.
- [ ] Real 422 validation body and status vocabulary. Then re-record
      `tests/fixtures/pint-ae/asp/acube/*.json`.
- [ ] TDD (Tax Data Document) availability and the separate recipient MLS acceptance or rejection.
      A TDD download leaves the FTA reporting outcome unconfirmed.
- [ ] Webhooks: delivered event names, delivery-error payload, retry re-signing, Ed25519 public key
      format. Verify that the complete company callback URL from row 6 reaches the app through the proxy.
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
- [ ] Company webhook signing secret (`webhookSecret`) and algorithm. Also the payloads of
      `invoice.passed` / `invoice.failed` and onboarding events.
- [ ] Purchase GET `data.xml` encoding and `attribution.companyId` on purchase webhooks.
- [ ] Buyer without a TRN: expected peppolId scheme and value (see A-Cube item above).
- [ ] UAE per-document credit cost and Unify rate limits; production key with write access.

## Sandbox run log

| Date | ASP | Seller TIN | providerMessageId | Outcome | Notes |
| ---- | --- | ---------- | ----------------- | ------- | ----- |
|      |     |            |                   |         |       |
